import { CustomerPage } from "./customer-page";

export default async function CustomerDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	return <CustomerPage customerId={id} />;
}
