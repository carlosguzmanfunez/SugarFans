// Explicit fictional data, bundled only by admin-workspace-review.mjs.
import type { User } from '../../src/lib/backend/types';
import { defaultSettings } from '../../src/lib/backend/shared';
export let scenario = 'pending';
export const calls: string[] = [];
const listeners = new Set<() => void>();
export const notify = () => listeners.forEach(fn => fn());
export function setScenario(value: string) { scenario = value; calls.length = 0; notify(); }
const at = new Date().toISOString();
export const accounts: User[] = Array.from({length: 36}, (_, i) => ({
  id: `qa-${i}`, name: i === 0 ? 'Carlos · Propietario de prueba' : i === 1 ? 'Mariana Silva' : `Persona de prueba ${i}`,
  email: `persona-${i}@example.invalid`, role: i === 0 ? 'admin' : i % 2 ? 'creator' : 'fan', isOwner: i === 0,
  avatar: '', isVerified: i !== 3, country: 'HN', createdAt: at, settings: defaultSettings,
  subscriptions: [], createdPosts: [], creatorProfileId: i % 2 ? `cp-${i}` : undefined,
}));
const read = async <T,>(data: T): Promise<T> => {
  const captured = scenario;
  await new Promise(resolve => setTimeout(resolve, captured === 'loading' ? 120000 : captured === 'slow' ? 2500 : 80));
  if (captured === 'error') throw Error('Fallo de consulta ficticio');
  return data;
};
export const mutation = async (label: string) => { calls.push(label); notify(); await new Promise(resolve => setTimeout(resolve, 200)); return {ok: true}; };
export const verification = {id:'verification-1',userId:'qa-3',userName:'Persona de prueba 3',email:'persona-3@example.invalid',role:'creator',legalName:'Persona de prueba 3',birthDate:'1990-05-05',country:'HN',docType:'dni',docNumber:'FICTICIO',docFront:'',selfie:'',status:'pending',submittedAt:at,provider:'manual'};
export const transactions = [{id:'sale-1',payerId:'qa-2',payerName:'Persona de prueba 2',creatorProfileId:'cp-1',creatorName:'Mariana Silva',kind:'tip',amount:100,gatewayFee:5.7,collectionFeeStatus:'estimated',methodLabel:'PayPal ficticio',status:'paid',createdAt:at},
  {id:'sale-2',payerId:'qa-4',payerName:'Persona de prueba 4',creatorProfileId:'cp-3',creatorName:'Persona de prueba 3',kind:'subscription',amount:50,gatewayFee:3,methodLabel:'PayPal ficticio',status:'disputed',createdAt:at}];
const usage = {month:at.slice(0,7), measuredAt:at, dbBytes:0,storageBytes:0,mau:36,usersTotal:36,emailsMonth:2100,emailsToday:0,scansMonth:0,kycMonth:0,videoMinutesMonth:0,plans:{},fundPct:10};
const reports = [{id:'report-1',kind:'post',targetId:'post-1',targetLabel:'Publicación de Mariana',reason:'Publicación por revisar',description:'Un fan reportó que este contenido necesita revisión. Todos estos datos son ficticios.',reporterName:'Fan de prueba',reporterId:'qa-2',status:'pending',createdAt:at}];
const moderation = [{bucket:'post-media',path:'qa/file.jpg',ownerId:'qa-1',ownerName:'Mariana Silva',kind:'post',mediaType:'image',status:'review',reason:'Revisión ficticia',provider:'simulado',createdAt:at}];
const noPending = () => scenario === 'empty';
export const backend: any = {
  mode:'local', onChange: (fn: () => void) => {listeners.add(fn);return()=>{listeners.delete(fn);};},
  listAccounts: () => read(accounts),
  moderationQueue: () => scenario === 'content-error' ? Promise.reject(Error('Fallo ficticio de contenido')) : read(noPending() ? [] : moderation),
  appErrors: () => read(noPending() ? [] : [{id:'error-1',source:'email',message:'Fallo ficticio del proveedor',detail:'Datos de diagnóstico de prueba',url:'/qa',userAgent:'QA',userName:'Mariana',count:2,firstSeen:at,lastSeen:at}]),
  infraUsage: () => read(usage), setInfraSettings: () => mutation('Guardar planificación'), reviewMedia: () => mutation('Decidir sobre archivo'),
  platform: {
    listVerifications: () => read(noPending() ? [] : [verification]), listReports: () => read(noPending() ? [] : reports),
    listPayouts: () => read([]), allPayments: () => read(noPending() ? [] : transactions), removedPosts: () => read([]),
    accountRestrictions: () => read([]), adminActions: () => read([{id:'history-1',adminName:'Carlos QA',userId:'qa-1',userName:'Mariana Silva',action:'unsuspend',reason:'Identidad aclarada en una prueba anterior',until:null,createdAt:at}]),
    reviewVerification: () => mutation('Decidir identidad'), resolveReport: () => mutation('Decidir denuncia'), restorePost: () => mutation('Restaurar publicación'),
    adminAccountAction: (_admin:User,id:string,action:string,reason:string) => mutation(`${action} · ${id} · ${reason}`),
    payoutCalendar: () => read({cycleStartDay:26,cycleEndDay:25,paymentStartDay:26,paymentEndDay:1,timeZone:'America/Tegucigalpa',legacyCutoff:'2026-10-01T00:00:00Z'}),
    managedProfiles: () => read([]),
  },
  gifts: {allCoinPurchases: () => read([])},
  finance: {mode:'local',overview: () => read({ok:true,data:{cutoff:at,window_open:true,quote_hash:'QA',execution_enabled:false,creators:[],batches:[],adjustments:[],trial_balance:[]}}),journal:()=>read({ok:true,data:[]}),
    operations:()=>read({ok:true,data:{environment:'sandbox',review_enabled:true,execution_enabled:false,authorization_confirmed:false,provider_tested:false,blocked:'EXECUTOR_DISABLED',incidents:[],alerts_pending:0,jobs:[],funding:null,statements:[]}})},
  special: { listAccounts: () => read([]), listInvites: () => read([]), createInvite: () => mutation('Crear invitación'), revokeInvite: () => mutation('Revocar invitación'), updateAccount: () => mutation('Cambiar beneficios') },
};
