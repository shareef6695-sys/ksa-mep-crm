// Inventory screens — moved verbatim from App.jsx (Prompt 15). Data and handlers come from the store (useErp).
import { useErp } from '../../app/ErpContext';
import { CURRENCIES } from '../../app/constants';
import { InventoryStockView } from '../../erp/InventoryStockView';
import { ItemsMasterView } from '../../erp/MasterDataViews';
import { can } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';

export default function InventoryScreens() {
  const { customUoms, customers, items, profile, refreshAllErpData, vendors, view, warehouses } = useErp();
  return (
    <>
          {view === 'cat_items' && (
            <ItemsMasterView
              readOnly={!can(profile, 'item.manage')}
              supabase={supabase}
              items={items}
              customUoms={customUoms}
              vendors={vendors}
              customers={customers}
              currencies={CURRENCIES}
              onRefresh={refreshAllErpData}
            />
          )}
          {view === 'inv_stock' && (
            <InventoryStockView supabase={supabase} items={items} warehouses={warehouses} canViewCost={can(profile, 'cost.view')} can={(a) => can(profile, a)} onRefresh={refreshAllErpData} />
          )}
    </>
  );
}
