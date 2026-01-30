(ns log
  (:require ["vscode" :as vscode]))


(defonce output-channel
  (.createOutputChannel (.-window vscode) "Beguile Logs"))

(defn log! [message]
  (.appendLine output-channel (str message)))

(defn show-output! []
  (.show output-channel false)
  (log! "=== Beguile Activation Started ==="))