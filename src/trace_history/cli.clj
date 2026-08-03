(ns trace-history.cli
  (:require [trace-history.store :as store]
            [trace-history.tui :as tui]))

(def usage "Usage: agents-analysis [--history <path>]\n\nOptions:\n  --history <path>  local history file\n  --help            show this help\n")

(defn parse [args]
  (cond
    (= ["--help"] args) {:exit 0 :out usage}
    (empty? args) {:exit 0 :history "datos/trazas.sqlite"}
    (and (= 2 (count args)) (= "--history" (first args)))
    {:exit 0 :history (second args)}
    :else {:exit 2 :err (str usage "Unknown option or arguments\n")}))

(defn- run-interactive [history input output error]
  (try
    (let [state (store/load-store (or history "datos/trazas.sqlite"))
          model (tui/start (:consultations state))]
      (binding [*in* input *out* output]
        (print (tui/render model))
        (flush)
        (loop [model model]
          (if-let [line (read-line)]
            (let [next (tui/handle-key model line)]
              (if (:exit-code next) (:exit-code next) (recur next)))
            0))))
    (catch Exception e
      (binding [*out* error] (println "Unable to start history TUI:" (.getMessage e)))
      1)))

(defn run [args input output error]
  (let [{:keys [exit history out err]} (parse args)]
    (cond
      (not= 0 exit) (do (binding [*out* error] (print err)) exit)
      out (do (binding [*out* output] (print out) (flush)) exit)
      :else (run-interactive history input output error))))

(defn -main [& args]
  (System/exit (run args *in* *out* *err*)))
