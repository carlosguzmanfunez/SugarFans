// Fans Reserve: offline accounting invariants (no provider credentials).
// Requires a throwaway local PostgreSQL instance; migrations applied by db-harness.
// Proves Credits purchase -> gifts -> creator accrual and a *synthetic trusted*
// exceptional reversal. Does NOT certify a PayPal webhook signature or LIVE.
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_credits_accounting_test';
const { check, expect, psql, as, setup, user, finish } = createDbTest(DB);

finish(async () => {
  setup();
  const creator = user('credits-creator@test.local', 'creator');
  const cp = psql(DB, `select creator_profile_id from public.profiles where id = '${creator}'`);
  const payer = user('credits-fan@test.local', 'fan');

  const creatorAccrued = () => Number(psql(DB, `select coalesce(sum(amount),0)
    from public.finance_sources where creator_profile_id='${cp}'`));
  const balance = () => Number(psql(DB, `select public.coin_balance('${payer}')`));
  const ref = 'QA-LOCAL-CREDIT-ORDER-1';
  let giftId = '';
  let creatorBefore = 0;

  await check('Compra de Créditos contabilizada sin regalar todavía', () => {
    creatorBefore = creatorAccrued();
    psql(DB, `insert into public.coin_purchases(user_id,pack_id,coins,price,method_label,status,paypal_ref)
      values ('${payer}','caja',2000,19.99,'QA synthetic','paid','${ref}')`);
    expect(balance() === 2000, `saldo inicial incorrecto: ${balance()}`);
    expect(creatorAccrued() === creatorBefore,
      'la compra de Créditos no debe generar todavía ingresos al creador');
  });

  await check('Regalo de 500 Créditos: fan 1500, creador USD 3, sin videollamada', () => {
    giftId = as(payer, `select public.send_gift('${cp}','QA Creator','tarta',
      null,'QA gift no promised perk',null)`);
    expect(balance() === 1500, `saldo del fan incorrecto: ${balance()}`);
    const giftOk = psql(DB,`select (amount=5 AND creator_share=0.6 AND status='paid')
      from public.transactions where id='${giftId}'`);
    expect(giftOk === 't', 'el regalo no registra $5, 60% y pago confirmado');
    const delta = Number((creatorAccrued() - creatorBefore).toFixed(2));
    expect(delta === 3, `la cuenta del creador no recibió USD 3: ${delta}`);
    expect(psql(DB,`select count(*) from public.perk_requests where transaction_id='${giftId}'`) === '0',
      'regalos actuales no ofrecen nuevos beneficios especiales');
  });

  await check('Vencimiento heredado nunca provoca devolución implícita', () => {
    psql(DB, `insert into public.perk_requests
      (transaction_id,fan_id,fan_name,creator_profile_id,creator_name,kind,request,status,due_at)
      values ('${giftId}','${payer}','QA Fan','${cp}','QA Creator',
       'video','historic obligation','pending',now()-interval '2 days')`);
    as(payer, 'select public.settle_overdue_perks()');
    expect(balance() === 1500, 'vencimiento devolvió Créditos al fan');
    expect(creatorAccrued() - creatorBefore === 3, 'vencimiento anuló remuneración del creador');
    expect(psql(DB,`select status from public.transactions where id='${giftId}'`) === 'paid',
      'vencimiento marcó el regalo como reembolsado');
    expect(psql(DB,`select status from public.perk_requests where transaction_id='${giftId}'`) === 'pending',
      'se borró la obligación histórica sin resolución');
  });

  await check('Devolución excepcional conciliada: fan y creador ajustados una sola vez', () => {
    // Only a local simulated trusted backend event, not an ordinary fan RPC.
    psql(DB,`select finance_private.income_money_back('${ref}','refund')`);
    expect(psql(DB,`select status from public.coin_purchases where paypal_ref='${ref}'`) === 'refunded',
      'la compra excepcionalmente devuelta no cambió estado');
    expect(psql(DB,`select status from public.transactions where id='${giftId}'`) === 'refunded',
      'el regalo gastado no se revirtió ante una devolución financiera confirmada');
    expect(balance() === 0, `la billetera no concilia tras la reversión: ${balance()}`);
    expect(creatorAccrued() === creatorBefore, 'se conservaron ingresos del creador indebidamente');
    psql(DB,`select finance_private.income_money_back('${ref}','refund')`);
    expect(balance() === 0 && creatorAccrued() === creatorBefore,
      'un segundo evento produjo otro ajuste financiero');
  });
});
