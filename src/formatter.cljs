(ns formatter
  (:require ["vscode" :as vscode]
            [promesa.core :as p]
            [guile :refer [send-request!]]))

(defn format-document [document]
  (let [full-text (.getText document)
        full-range (new vscode/Range 0 0 (.-lineCount document) 0)]

    (p/let [formatted-text (send-request! "beguile/format" {:code full-text})]
      (if (and formatted-text (not= formatted-text full-text))
        (clj->js [(vscode/TextEdit.replace full-range formatted-text)])
        (clj->js [])))))

(defn register-formatter [context]
  (let [provider (clj->js {:provideDocumentFormattingEdits
                           (fn [document options token]
                             (format-document document))})]

    (.push (.-subscriptions context)
           (.registerDocumentFormattingEditProvider
            (.-languages vscode)
            "scheme"
            provider))))