// background.js - Handles requests from the UI, runs the model, then sends back a response

import {
  pipeline,
  env,
  AutoModelForCausalLM,
  AutoTokenizer,
  TextStreamer,
  StoppingCriteria,
} from "@xenova/transformers";

// Skip initial check for local models, since we are not loading any local models.
env.allowLocalModels = false;

// Due to a bug in onnxruntime-web, we must disable multithreading for now.
// See https://github.com/microsoft/onnxruntime/issues/14445 for more information.
//
// (Note by fs-eire)
// The issue mentioned above is fixed in the latest version of ORT. However, multi-threading is still not working in service workers, because
// of a different issue: https://github.com/whatwg/html/issues/8362
env.backends.onnx.wasm.numThreads = 1;

// env.backends.onnx.wasm.wasmPaths =
//   "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/";

// (Note by fs-eire)
// In this example, the .wasm file is included (and processed/renamed by webpack) in the "build" folder. So we don't need to override the wasm path.
//
// However, Transformer.js will set this flag to a CDN path. If we keep the override, the WebAssembly will failed to load because there is a version mismatch.
// ORT only works when the .wasm file and the .mjs file match (they need to be generated from the same build).
//
// So, we need to set this flag to undefined to revert it back to the default behavior.
env.backends.onnx.wasm.wasmPaths = undefined;

class CallbackTextStreamer extends TextStreamer {
  constructor(tokenizer, cb) {
    super(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
    });
    this.cb = cb;
  }

  on_finalized_text(text) {
    this.cb(text);
  }
}

class InterruptableStoppingCriteria extends StoppingCriteria {
  constructor() {
    super();
    this.interrupted = false;
  }

  interrupt() {
    this.interrupted = true;
  }

  reset() {
    this.interrupted = false;
  }

  _call(input_ids, scores) {
    return new Array(input_ids.length).fill(this.interrupted);
  }
}

const stopping_criteria = new InterruptableStoppingCriteria();

async function hasFp16() {
  try {
    const adapter = await navigator.gpu.requestAdapter();
    console.log("ADAPTER FOUND: ", adapter);
    return adapter.features.has("shader-f16");
  } catch (e) {
    return false;
  }
}

class PipelineSingleton {
  static task = "feature-extraction";
  static model_id = "Xenova/Phi-3-mini-4k-instruct_fp16";
  static model = null;
  static instance = null;

  static async getInstance(progress_callback = null) {
    this.model_id ??= (await hasFp16())
      ? "Xenova/Phi-3-mini-4k-instruct_fp16"
      : "Xenova/Phi-3-mini-4k-instruct";

    this.tokenizer ??= AutoTokenizer.from_pretrained(this.model_id, {
      legacy: true,
      progress_callback,
    });

    this.model ??= AutoModelForCausalLM.from_pretrained(this.model_id, {
      dtype: "q4",
      device: "webgpu",
      use_external_data_format: true,
      progress_callback,
    });

    return Promise.all([this.tokenizer, this.model]);
  }

  // static async getInstance(progress_callback = null) {
  //   if (this.instance === null) {
  //     this.instance = pipeline(this.task, this.model, {
  //       progress_callback,
  //       // device: "webgpu",
  //     });
  //   }

  //   return this.instance;
  // }
}

// Create generic classify function, which will be reused for the different types of events.
const classify = async (text) => {
  // Get the pipeline instance. This will load and build the model when run for the first time.
  const [tokenizer, model] = await PipelineSingleton.getInstance((data) => {
    // You can track the progress of the pipeline creation here.
    // e.g., you can send `data` back to the UI to indicate a progress bar
    console.log("progress", data);
    // data logs as this:
    /**
     * 
     * {
    "status": "progress",
    "name": "Xenova/Phi-3-mini-4k-instruct_fp16",
    "file": "onnx/model_q4.onnx",
    "progress": 99.80381792394503,
    "loaded": 836435968,
    "total": 838080131
  }

  when complete, last status will be 'done'
     */
  });
  /////////////
  const inputs = tokenizer.apply_chat_template(text, {
    add_generation_prompt: true,
    return_dict: true,
  });

  let startTime;
  let numTokens = 0;
  const cb = (output) => {
    startTime ??= performance.now();

    let tps;
    if (numTokens++ > 0) {
      tps = (numTokens / (performance.now() - startTime)) * 1000;
    }
    self.postMessage({
      status: "update",
      output,
      tps,
      numTokens,
    });
  };

  const streamer = new CallbackTextStreamer(tokenizer, cb);

  // Tell the main thread we are starting
  self.postMessage({ status: "start" });

  const outputs = await model.generate({
    ...inputs,
    max_new_tokens: 512,
    streamer,
    stopping_criteria,
  });
  const outputText = tokenizer.batch_decode(outputs, {
    skip_special_tokens: false,
  });

  // Send the output back to the main thread
  self.postMessage({
    status: "complete",
    output: outputText,
  });
  ///////////////

  // Actually run the model on the input text
  // let result = await model(text);
  // return result;
};

////////////////////// 1. Context Menus //////////////////////
//
// Add a listener to create the initial context menu items,
// context menu items only need to be created at runtime.onInstalled
chrome.runtime.onInstalled.addListener(function () {
  // Register a context menu item that will only show up for selection text.
  chrome.contextMenus.create({
    id: "classify-selection",
    title: 'Classify "%s"',
    contexts: ["selection"],
  });
});

// Perform inference when the user clicks a context menu
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Ignore context menu clicks that are not for classifications (or when there is no input)
  if (info.menuItemId !== "classify-selection" || !info.selectionText) return;

  // Perform classification on the selected text
  let result = await classify(info.selectionText);

  // Do something with the result
  chrome.scripting.executeScript({
    target: { tabId: tab.id }, // Run in the tab that the user clicked in
    args: [result], // The arguments to pass to the function
    function: (result) => {
      // The function to run
      // NOTE: This function is run in the context of the web page, meaning that `document` is available.
      console.log("result", result);
      console.log("document", document);
    },
  });
});
//////////////////////////////////////////////////////////////

////////////////////// 2. Message Events /////////////////////
//
// Listen for messages from the UI, process it, and send the result back.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("sender", sender);
  if (message.action !== "classify") return; // Ignore messages that are not meant for classification.

  // Run model prediction asynchronously
  (async function () {
    // Perform classification
    let result = await classify(message.text);

    // Send response back to UI
    sendResponse(result);
  })();

  // return true to indicate we will send a response asynchronously
  // see https://stackoverflow.com/a/46628145 for more information
  return true;
});
//////////////////////////////////////////////////////////////
