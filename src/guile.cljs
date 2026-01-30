(ns guile
  (:require [promesa.core :as p]
            [goog.object :as gobj]
            [clojure.string :as str]
            [log :refer [log!]]
            ["net" :as net]
            ["path" :as path]
            ["child_process" :as cp]
            ["fs" :as fs]
            ["os" :as os]))


(defonce server-proc (atom nil))
(defonce client-socket (atom nil))
(defonce request-id (atom 0))
(defonce pending-requests (atom {}))
(defonce input-buffer (atom ""))

(defn get-free-port! []
  (let [deferred (p/deferred)
        server (.createServer net)]
    (.listen server 0
             (fn []
               (let [port (.-port (.address server))]
                 (.close server (fn []
                                  (p/resolve! deferred port))))))
    (.on server "error" (fn [err] (p/reject! deferred err)))
    deferred))

(defn connect-to-server! [port]
  (log! (str "Connecting to Guile on port " port "..."))
  (let [socket (net/createConnection port "127.0.0.1")]

    (.on socket "data"
         (fn [data]
           (swap! input-buffer str (.toString data))
           (let [raw @input-buffer]
             (when (str/includes? raw "\n")
               (let [parts (str/split raw #"\n" -1)]
                 (dotimes [i (dec (count parts))]
                   (let [line (nth parts i)]
                     (when-not (str/blank? line)
                       (try
                         (let [response (js/JSON.parse line)
                               id (gobj/get response "id")
                               result (gobj/get response "result")]
                           (when-let [resolver (get @pending-requests id)]
                             (p/resolve! resolver result)
                             (swap! pending-requests dissoc id)))
                         (catch :default e
                           (log! (str "JSON Parse Error: " e)))))))
                 (reset! input-buffer (last parts)))))))

    (.on socket "error" #(log! (str "Socket Error: " %)))

    (reset! client-socket socket)
    (log! "Connected via TCP!")))

(defn send-request! [method params]
  (let [id (swap! request-id inc)
        payload (js/JSON.stringify
                 (clj->js {:jsonrpc "2.0"
                           :id id
                           :method method
                           :params params}))
        prom (p/deferred)]

    (if-let [sock @client-socket]
      (do
        (swap! pending-requests assoc id prom)
        (.write sock (str payload "\n"))
        prom)
      (p/rejected "No connection to Beguile server."))))


(defn start-guile-server! [ext-path]
  (when-let [old-proc @server-proc]
    (.kill old-proc "SIGKILL"))

  (p/let [port (get-free-port!)]
    (log! (str "OS assigned free port: " port))

    (let [script-path (path/join ext-path "guile/server.scm")
          proc (cp/spawn "guile" (clj->js [script-path "--port" (str port)]))]

      (.on (.-stdout proc) "data"
           (fn [data]
             (let [msg (.toString data)]
               (log! (str "SERVER OUT: " msg))
               (when (str/includes? msg "Ready")
                 (connect-to-server! port)))))

      (.on (.-stderr proc) "data"
           (fn [data]
             (log! (str "SERVER LOG: " (.toString data)))))

      (.on proc "exit"
           (fn [code signal]
             (log! (str "Guile exited. Code: " code))
             (reset! server-proc nil)
             (reset! client-socket nil)))

      (reset! server-proc proc))))

(defn stop-guile-server! []
    (when-let [sock @client-socket]
    (.end sock)
    (.destroy sock))
  
  (when-let [proc @server-proc]
    (.kill proc "SIGKILL")))