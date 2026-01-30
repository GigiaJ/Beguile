(ns extension
  (:require
   ["vscode" :as vscode]
   [guile :refer [start-guile-server! stop-guile-server!]]
   [highlighter :refer [update-scope-highlight]]
   [formatter :refer [register-formatter]]
   [paredit :refer [register-paredit]]
   [parser :refer [init-parser!]]
   [semantic :refer [register-hover register-semantic-highlighting register-completion-provider register-definition-provider]]))

(defn activate [context]
  (init-parser! context)
  (start-guile-server! (.-extensionPath context))

  (register-semantic-highlighting context)
  (register-hover context)
  (register-definition-provider context)
  (register-formatter context)
  (register-paredit context)
  ;;(register-completion-provider context)

  (.push (.-subscriptions context)
         (vscode/window.onDidChangeTextEditorSelection
          (fn [e] (update-scope-highlight (.-textEditor e)))))
  nil)

(defn deactivate []
  (stop-guile-server!)
  nil)