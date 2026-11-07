#[path = "../../../src/mt.rs"]
mod mt;
#[path = "../../../src/spm.rs"]
mod spm;
use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub struct Translator(mt::Model);
#[wasm_bindgen]
impl Translator {
    #[wasm_bindgen(constructor)]
    pub fn new(model: &[u8], vocabulary: &[u8], shortlist: &[u8]) -> Result<Translator, JsValue> {
        mt::Model::from_bytes(model, vocabulary, Some(shortlist))
            .map(Translator).map_err(|e| JsValue::from_str(&format!("{e:#}")))
    }
    pub fn translate(&self, text: &str) -> String { self.0.translate(text) }
}
