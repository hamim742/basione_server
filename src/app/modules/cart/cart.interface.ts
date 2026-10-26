export interface ICartItemPayload {
  bannerId?: string;
  partyProductId?: string;
  quantity: number;
  hasEyelets?: boolean;
}

export interface ISyncCartPayload {
  items: ICartItemPayload[];
}
