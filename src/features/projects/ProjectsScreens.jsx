// Projects screens — moved verbatim from App.jsx (Prompt 15). Data and handlers come from the store (useErp).
import { useErp } from '../../app/ErpContext';
import { ContractsView, JobCostView, ProjectsView, ServiceTicketsView } from '../../erp/ProjectsAndContracts';
import { can } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';

export default function ProjectsScreens() {
  const { afterInvoicePosted, customers, invoices, profile, projects, refreshAllErpData, salesOrders, teamProfiles, view } = useErp();
  return (
    <>
          {view === 'proj_projects' && (
            <ProjectsView supabase={supabase} projects={projects} customers={customers} salesOrders={salesOrders} invoices={invoices}
              canManage={can(profile, 'project.manage')} canBill={can(profile, 'project.bill')} onRefresh={refreshAllErpData} onPostedInvoice={afterInvoicePosted} />
          )}
          {view === 'proj_job_cost' && <JobCostView supabase={supabase} />}
          {view === 'proj_contracts' && (
            <ContractsView supabase={supabase} customers={customers} canManage={can(profile, 'contract.manage')} canActivate={can(profile, 'contract.activate')}
              canBill={can(profile, 'contract.bill')} canRecognize={can(profile, 'revenue.recognize')} onPostedInvoice={afterInvoicePosted} />
          )}
          {view === 'proj_tickets' && <ServiceTicketsView supabase={supabase} customers={customers} teamProfiles={teamProfiles} canBill={can(profile, 'ticket.bill')} onPostedInvoice={afterInvoicePosted} />}
    </>
  );
}
