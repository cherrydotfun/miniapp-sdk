export { CherryWalletAdapter, CherryWalletAdapterName, type CherryWalletAdapterConfig } from './wallet-adapter';
export {
  getAppReferenceKey,
  withAppReference,
  buildCherryFeeSplit,
  buildCherryShareTransfer,
  type CherryFeeSplitParams,
  type CherryShareTransferParams,
  type PublicKeyLike,
} from './attribution';
export {
  splitCherryFee,
  cherryShareOf,
  CHERRY_REVENUE_SHARE_BPS,
  type CherryFeeSplitAmounts,
} from '../attribution';

// Transaction labels: wrap a standard sendTransaction / kit signer call so
// Cherry's wallet sheet says what it does.
export { withTransactionLabel, TRANSACTION_LABEL_MAX } from '../label';
