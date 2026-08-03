#!/usr/bin/env bb
(require '[cheshire.core :as json]
         '[trace-history.acceptance :as acceptance])

(doseq [line (line-seq (java.io.BufferedReader. (java.io.InputStreamReader. System/in)))]
  (let [request (json/parse-string line true)
        started (System/nanoTime)]
    (try
      (acceptance/run-file (:feature_json request))
      (println (json/generate-string {:id (:id request)
                                      :outcome "test_success"
                                      :duration (- (System/nanoTime) started)}))
      (catch Exception error
        (println (json/generate-string {:id (:id request)
                                        :outcome "test_failure"
                                        :error (.getMessage error)
                                        :duration (- (System/nanoTime) started)}))))
    (flush)))
