(require '[clojure.test :as t])
(require 'trace-history.core-test)
(require 'trace-history.tui-test)
(let [result (t/run-tests 'trace-history.core-test 'trace-history.tui-test)]
  (when (pos? (+ (:fail result) (:error result)))
    (System/exit 1)))
