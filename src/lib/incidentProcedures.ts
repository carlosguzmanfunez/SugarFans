export type CaseAction='note'|'coverage'|'release_hold'|'ack_alert'|'close_review';
export type CaseParty='undetermined'|'creator'|'fan'|'platform'|'provider';
export type CaseCategory='unresolved'|'human_input'|'service_delivery'|'platform_processing'|'provider_processing'|'other';
export interface CaseItem {id:string;code:string;title:string;detail:string;state:'open'|'resolved';episode:number;first_seen_at:string;reference:string;followup_at:string|null}
export interface CasePage {items:CaseItem[];total:number}
export interface CasePreview {
 issue:string|null;incident:string;episode:number;state:'open'|'resolved';code:string;title:string;hash:string;actions:CaseAction[];
 source:{transaction?:string;creator?:string;status?:string;covered?:boolean;amount?:number;creator_cut?:number;source_revision?:number;
 id?:string;user_id?:string;kind?:string;reason?:string;released?:boolean;remaining_holds?:number;blockers?:string[];reference?:string;detail?:string;
 alert?:string;state?:string;attempts?:number;recipient?:string|null;first_attempt_at?:string;original_incident?:string;parent_incident?:string;followup_at?:string};
 history:{id:string;sequence:number;action:CaseAction;party:CaseParty;category:CaseCategory;evidence:string;reason:string;notice:string|null;followup_at:string|null;created_at:string;created_by:string;result:Record<string,unknown>}[];
}
export interface CaseDecision {id:string;key:string;expected:string;action:CaseAction;party:CaseParty;category:CaseCategory;evidence:string;reason:string;notice?:string|null;followup?:string|null}
export const caseParties:Record<CaseParty,string>={undetermined:'Aún por determinar',creator:'Creador',fan:'Fan',platform:'Fans Reserve (incluye nuestro equipo)',provider:'Proveedor de pagos o servicios'};
export const caseCategories:Record<CaseCategory,string>={unresolved:'Falta determinar la causa',human_input:'Dato o instrucción humana incorrecta',service_delivery:'Incumplimiento de la experiencia o del servicio',platform_processing:'Fallo de procesamiento de Fans Reserve',provider_processing:'Fallo comprobado del proveedor',other:'Otra causa documentada'};
export const caseActions:Record<CaseAction,string>={note:'Registrar seguimiento',coverage:'Aplicar cobertura según responsabilidad',release_hold:'Liberar este motivo de bloqueo',ack_alert:'Registrar atención del aviso fallido',close_review:'Cerrar revisión comprobada'};
export const caseGuidance:Record<string,string>={
 DISPUTE_CASE:'Verifica qué ocurrió, quién aportó el dato o prestó el servicio y qué confirmó PayPal. La atribución no cambia el resultado del proveedor. La cobertura utiliza el contrato vigente.',
 PAYOUT_HOLD:'Revisa cada causa. Solo puede liberarse este motivo cuando no quedan riesgos incompatibles; otros bloqueos conservan la retención.',
 ALERT_DELIVERY:'Atiende la incidencia desde el dashboard o por un canal alterno y registra la constancia. El historial seguirá mostrando que este correo no confirmó entrega.',
 FUNDING_REVIEW:'Comprueba el saldo disponible actual y registra una evidencia nueva en Fondos disponibles para los envíos. La evidencia anterior conserva su fecha y vence a las 24 horas.',
 PAYOUT_PENDING:'Consulta y concilia el retiro con su misma referencia. Conserva el dinero apartado hasta que PayPal confirme el resultado.',
 PROVIDER_EVENT:'Revisa el aviso firmado y su consulta conciliada. Una nota no cambia el estado del proveedor ni libera fondos.',
 STATEMENT_REVIEW:'Corrige la conciliación con evidencia. Para costos de retiro usa Revisar diferencia de comisión; no fuerces una coincidencia modificando el original.',
 BATCH_REVIEW:'Revisa las ganancias asignadas y el cambio posterior al cierre. No liberes un lote que tenga un envío incierto.',
 PREPARATION_FAILED:'Revisa la causa, los fondos y la referencia del envío original. La preparación correcta resuelve la incidencia; una nota no reinicia un retiro.',
 JOB_FAILURE:'Corrige la conexión o el servicio y ejecuta Revisar ahora. Una revisión completada correctamente resuelve esta incidencia.',
 CASE_OVERDUE:'Abre el expediente original y documenta su seguimiento. Cambiar una fecha interna no modifica los plazos de PayPal ni autoriza un pago.',
};
export const caseEffects=(action:CaseAction,party:CaseParty)=>({
 note:'Se guarda el seguimiento y su próxima revisión. No cambia el saldo ni libera bloqueos.',
 coverage:party==='creator'?'Se mantiene a cargo del creador la parte de esta venta prevista en el contrato. Si ya estaba descontada, no se descuenta otra vez.':'Fans Reserve cubre la parte del creador según el contrato 6.2.3. Registrar al fan o al proveedor como responsable no genera un cobro externo.',
 release_hold:'Se libera este motivo documentado. Si hay otro bloqueo activo, la cuenta seguirá retenida. Esta acción no envía dinero.',
 ack_alert:'Se registra la atención humana; el correo no se marca como entregado. La incidencia que originó el aviso conserva su propio estado.',
 close_review:'Se cierra esta revisión porque la condición comprobada lo permite. El estado informado por PayPal se conserva.',
})[action];
