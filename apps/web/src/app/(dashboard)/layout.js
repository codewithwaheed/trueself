import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/session";
import { Sidebar } from "@/components/sidebar";
export default async function DashboardLayout({ children, }) {
    const user = await getAuthUser();
    if (!user) {
        redirect("/login");
    }
    return (<div className="flex h-screen overflow-hidden bg-grid">
      <Sidebar userName={user.name} userEmail={user.email} userRole={user.role} companyName={user.companyName}/>
      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>);
}
//# sourceMappingURL=layout.js.map