(require '[clojure.test :as t]
         'trace-history.property-test)

(let [result (t/run-tests 'trace-history.property-test)]
  (when (pos? (+ (:fail result) (:error result)))
    (System/exit 1)))
