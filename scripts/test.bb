(require '[clojure.test :as t])
(require 'trace-history.core-test)
(let [result (t/run-tests 'trace-history.core-test)]
  (when (pos? (+ (:fail result) (:error result)))
    (System/exit 1)))
