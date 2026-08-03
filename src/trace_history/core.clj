(ns trace-history.core)

(defn completed? [record]
  (= :completed (:status record)))

(defn visible-consultations [records]
  (filterv completed? records))

(defn save-completed [records record]
  (let [records (if (map? records) (vals records) records)
        without-id (remove #(= (:id %) (:id record)) records)]
    (conj (vec without-id) record)))

(defn attach-cost [record rates]
  (if (and rates (map? (:usage record))
           (every? #(contains? rates %) [:input :prompt :thinking :output]))
    (assoc record
           :cost (reduce + (map #(* (double (get-in record [:usage %] 0))
                                    (double (get rates %)))
                                [:input :prompt :thinking :output]))
           :rate-snapshot rates)
    (dissoc record :cost :rate-snapshot)))

(defn- token-total [record]
  (reduce + (map #(long (get-in record [:usage %] 0))
                 [:input :prompt :thinking :output])))

(defn summarize [records]
  (let [records (visible-consultations records)
        costs (keep :cost records)
        currency (some :currency records)]
    {:tokens (reduce + (map token-total records))
     :cost (when (seq costs) (reduce + costs))
     :currency currency}))
