-- Replace the placeholder payment_type set from 004 with the actual set of
-- checkout methods (HitPay's supported methods, plus PayNow which is
-- processed directly rather than through HitPay). Existing values are
-- remapped rather than dropped, in case any sales were already recorded:
--   local_card -> domestic_card, overseas_card -> international_card,
--   wechat_alipay -> wechatpay (closest single match), qr -> paynow.
alter type payment_type rename to payment_type_old;

create type payment_type as enum (
  'cash',
  'domestic_card',
  'international_card',
  'paynow',
  'grabpay',
  'paylater_grab',
  'shopeepay',
  'atome',
  'shopback',
  'wechatpay',
  'alipay',
  'upi',
  'cdc_vouchers'
);

alter table items
  alter column payment_type type payment_type
  using (
    case payment_type::text
      when 'local_card'    then 'domestic_card'
      when 'overseas_card' then 'international_card'
      when 'wechat_alipay' then 'wechatpay'
      when 'qr'            then 'paynow'
      else payment_type::text
    end
  )::payment_type;

drop type payment_type_old;
