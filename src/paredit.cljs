(ns paredit
  (:require ["vscode" :as vscode]
            [parser :refer [parser-ref]]))


(defn move-editor-selection [editor new-pos select?]
  (let [anchor (if select? (.-anchor (.-selection editor)) new-pos)
        new-selection (new vscode/Selection anchor new-pos)]
    (set! (.-selection editor) new-selection)
    (.revealRange editor new-selection)))

(defn find-forward-target [root offset]
  (let [node (.descendantForIndex root offset)]
    (when node
      (let [type (.-type node)
            start (.-startIndex node)
            end (.-endIndex node)
            parent (.-parent node)]

        (cond
          (and (#{"(" "[" "#~" "#$"} type) parent)
          (.-endIndex parent)

          (and (= type "list") (not= offset start))
          (let [children (array-seq (.-children node))
                next-child (some #(when (> (.-startIndex %) offset) %) children)]
            (if next-child
              (.-endIndex next-child)
              end))

          (< offset end)
          end

          :else
          (let [working-node (if (= offset end) node node)]
            (loop [curr working-node]
              (if-let [sibling (.-nextSibling curr)]
                (.-endIndex sibling)
                (if-let [p (.-parent curr)]
                  (if (= (.-type p) "program") nil (.-endIndex p))
                  nil)))))))))

(defn find-backward-target [root offset]
  (let [lookup-index (max 0 (dec offset))
        node (.descendantForIndex root lookup-index)]

    (when node
      (let [type (.-type node)
            start (.-startIndex node)
            parent (.-parent node)]

        (cond
          (and (#{")" "]"} type) parent)
          (.-startIndex parent)

          (and (= type "list") (> offset start))
          (let [children (reverse (array-seq (.-children node)))
                prev-child (some #(when (<= (.-endIndex %) offset) %) children)]
            (if prev-child
              (.-startIndex prev-child)
              start))

          (> offset start)
          start

          :else
          (let [working-node (if (= offset start) node node)]
            (loop [curr working-node]
              (if-let [sibling (.-previousSibling curr)]
                (.-startIndex sibling)
                (if-let [p (.-parent curr)]
                  (cond
                    (= (.-type p) "program") nil
                    (= (.-startIndex p) offset) (recur p)
                    :else (.-startIndex p))
                  nil)))))))))

(defn navigate-sexp [direction select?]
  (let [editor (.-activeTextEditor (.-window vscode))]
    (when (and editor @parser-ref)
      (let [doc (.-document editor)
            text (.getText doc)
            tree (.parse @parser-ref text)
            root (when tree (.-rootNode tree))
            offset (.offsetAt doc (.-active (.-selection editor)))]

        (when root
          (let [target-offset (if (= direction :forward)
                                (find-forward-target root offset)
                                (find-backward-target root offset))]

            (when (and target-offset (not= target-offset offset))
              (let [new-pos (.positionAt doc target-offset)]
                (move-editor-selection editor new-pos select?)))))))))

(defn register-paredit [context]
  (let [subs (.-subscriptions context)]
    (.push subs (vscode/commands.registerCommand "beguile.forwardSexp" #(navigate-sexp :forward false)))
    (.push subs (vscode/commands.registerCommand "beguile.backwardSexp" #(navigate-sexp :backward false)))
    (.push subs (vscode/commands.registerCommand "beguile.selectForwardSexp" #(navigate-sexp :forward true)))
    (.push subs (vscode/commands.registerCommand "beguile.selectBackwardSexp" #(navigate-sexp :backward true)))))