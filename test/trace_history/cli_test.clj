(ns trace-history.cli-test
  (:require [clojure.test :refer [deftest is]]
            [trace-history.cli :as cli]))

(deftest help-is-successful
  (is (= 0 (:exit (cli/parse ["--help"]))))
  (is (re-find #"agents-analysis" (:out (cli/parse ["--help"])))))

(deftest unknown-option-is-an-error
  (is (= 2 (:exit (cli/parse ["--unknown"])))))
