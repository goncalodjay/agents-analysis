(ns trace-history.store
  (:require [clojure.edn :as edn]
            [clojure.java.io :as io]))

(defn load-store [path]
  (if (.exists (io/file path))
    (edn/read-string (slurp path))
    {:consultations [] :rates {}}))

(defn save-store! [path state]
  (io/make-parents path)
  (spit path (pr-str state))
  state)
