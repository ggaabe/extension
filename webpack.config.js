import path from "path";
import { fileURLToPath } from "url";

import HtmlWebpackPlugin from "html-webpack-plugin";
import CopyPlugin from "copy-webpack-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = {
  mode: "development",
  experiments: { outputModule: true },  // This is required to generate ES6 modules
  devtool: "inline-source-map",
  entry: {
    background: "./src/background.js",
    popup: "./src/popup.js",
    content: "./src/content.js",
  },
  output: {
    path: path.resolve(__dirname, "build"),
    filename: "[name].js",
    // environment: {
    //   module: true, // Ensure the output is treated as an ES module
    // },
    library: { type: 'module' },  // This is required to generate ES6 modules
    chunkFormat: 'module',  // This is required to generate ES6 modules for webworker target
  },
  target: "webworker",

  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/popup.html",
      filename: "popup.html",
      scriptLoading: "module"  // fix for ES6 modules
    }),
    new CopyPlugin({
      patterns: [
        {
          from: "public",
          to: ".", // Copies to build folder
        },
        {
          from: "src/popup.css",
          to: "popup.css",
        },
      ],
    }),
  ],
};

export default config;
