import type { SupabaseClient } from '@supabase/supabase-js';
import type { ISubscriptionPaymentRepo, SubscriptionPaymentInput } from '../interfaces';

export class SubscriptionPaymentRepo implements ISubscriptionPaymentRepo {
  constructor(private readonly client: SupabaseClient) {}

  async replaceForCheckout(checkoutId: string, payments: SubscriptionPaymentInput[]): Promise<void> {
    const { error: deleteError } = await this.client
      .from('brain_subscription_payments')
      .delete()
      .eq('checkout_id', checkoutId);

    if (deleteError) {
      throw new Error(`SubscriptionPaymentRepo.replaceForCheckout delete failed: ${deleteError.message}`);
    }

    if (payments.length === 0) return;

    const { error: insertError } = await this.client
      .from('brain_subscription_payments')
      .insert(payments.map(p => ({
        store_id:     p.storeId,
        customer_id:  p.customerId,
        visit_id:     p.visitId,
        staff_id:     p.staffId,
        checkout_id:  checkoutId,
        item_name:    p.itemName,
        amount:       p.amount,
        payment_date: p.paymentDate,
      })));

    if (insertError) {
      throw new Error(`SubscriptionPaymentRepo.replaceForCheckout insert failed: ${insertError.message}`);
    }
  }
}
