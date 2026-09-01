-- Payment tracking on sold items: which method the buyer paid with, and the
-- card processing fee incurred (overseas card payments are the ones that
-- usually carry a fee the store absorbs). Both nullable — existing sold
-- items are left blank rather than backfilled with a guessed value.
create type payment_type as enum (
  'cash',
  'local_card',
  'overseas_card',
  'wechat_alipay',
  'qr'
);

alter table items
  add column payment_type payment_type,
  add column card_fee numeric(10,2);
