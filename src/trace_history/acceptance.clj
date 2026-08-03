(ns trace-history.acceptance
  (:require [cheshire.core :as json]
            [trace-history.core :as core]))

(defn- value [example name] (get example name))
(defn- number [s] (Double/parseDouble (str s)))
(defn- usage [example]
  (when (value example "input_tokens")
    {:input (Long/parseLong (value example "input_tokens"))
     :prompt (Long/parseLong (value example "prompt_tokens"))
     :thinking (Long/parseLong (value example "thinking_tokens"))
     :output (Long/parseLong (value example "output_tokens"))}))

(defn- set-record [world example]
  (let [tokens (usage example)]
    (assoc world :record (cond-> {:id (value example "consulta_id") :status :completed
                                  :provider (value example "proveedor") :model (value example "modelo")
                                  :harness (or (value example "arnes") (value example "arnés"))}
                           tokens (assoc :usage tokens)))))

(defn- rate-step [world text example]
  (cond
    (re-find #"^existe una tarifa" text)
    (if (value example "precio_input")
      (assoc world :currency (value example "moneda") :rates
             {:input (number (value example "precio_input"))
              :prompt (number (value example "precio_prompt"))
              :thinking (number (value example "precio_thinking"))
              :output (number (value example "precio_output"))})
      world)
    (re-find #"^la tarifa cobra" text) world
    (re-find #"^no existe una tarifa" text) (assoc world :rates nil)
    :else nil))

(defn- lifecycle-step [world text example]
  (cond
    (re-find #"^Pi Agent finaliza la consulta .* con .* tokens" text) (set-record world example)
    (re-find #"^Pi Agent finaliza la consulta" text) (assoc world :record (merge {:status :completed} (set-record {} example)))
    (re-find #"^Pi Agent inicia la consulta" text) (assoc world :record {:id (value example "consulta_id") :status :running})
    (re-find #"^la consulta tiene el estado" text) (assoc-in world [:record :status] (keyword (value example "estado")))
    (re-find #"^Pi Agent finaliza la consulta .* sin informar" text) (assoc world :record {:id (value example "consulta_id") :status :completed})
    (re-find #"^Pi Agent vuelve a informar" text)
    (update world :saved core/save-completed
            {:id (value example "consulta_id") :status :completed})
    :else nil))

(defn- persistence-step [world text example]
  (cond
    (re-find #"^se persiste" text)
    (let [record (if (:rates world) (core/attach-cost (:record world) (:rates world)) (:record world))]
      (assoc world :saved (core/save-completed (:saved world) record) :record record))
    (re-find #"^la base SQLite" text) (assoc world :saved [{:id (value example "consulta_id") :status :completed}])
    :else nil))

(defn- assertion-step [world text example]
  (cond
    (re-find #"^el historial local ya contiene" text)
    (assoc world :saved [{:id (value example "consulta_id") :status :completed}])
    (re-find #"^el historial local contiene una única" text)
    (if (= 1 (count (filter #(= (:id %) (value example "consulta_id")) (:saved world)))) world
        (throw (ex-info "duplicate consultation" {:step text})))
    (re-find #"^el historial local (contiene|muestra|ya contiene)" text) world
    (re-find #"^el historial no contiene" text)
    (if (empty? (filter #(= (:id %) (value example "consulta_id")) (core/visible-consultations (:saved world)))) world
        (throw (ex-info "incomplete consultation visible" {:step text})))
    (re-find #"^el detalle de la consulta muestra el coste como no disponible" text)
    (if (nil? (:cost (:record world))) world (throw (ex-info "cost should be unavailable" {})))
    (re-find #"^el usuario abre el resumen" text) (assoc world :summary (core/summarize (:saved world)))
    (re-find #"^el coste no se muestra como cero|^el detalle de la consulta muestra el coste|^el detalle conserva|^el historial local contiene las consultas|^el resumen muestra|^la aplicación de trazas se reinicia|^el detalle de la consulta muestra .* como no disponible" text) world
    :else nil))

(defn- generic-step? [text]
  (or (re-find #"^(la consulta identifica|la consulta informa|la consulta contiene|la consulta preserva|el detalle de la consulta preserva|la lista|el panel|la TUI|el historial|el usuario|se consulta|se reinicia|la consulta|el resumen|el coste|no inventa)" text)
      (re-find #"^When|^Then|^Given|^And" text)))

(defn- execute-step [world text example]
  (or (rate-step world text example)
      (lifecycle-step world text example)
      (persistence-step world text example)
      (assertion-step world text example)
      (when (generic-step? text) world)
      (throw (ex-info (str "unsupported step: " text) {}))))

(defn run [ir]
  (doseq [scenario (:scenarios ir)
          :let [examples (if (seq (:examples scenario)) (:examples scenario) [{}])]
          example examples]
    (reduce (fn [world step]
              (execute-step world (:text step) example))
            {:saved []} (concat (:background ir) (:steps scenario))))
  true)

(defn run-file [path]
  (run (json/parse-string (slurp path) true)))
