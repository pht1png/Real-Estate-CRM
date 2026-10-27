import { ContactPage } from "./contact-page";

export default async function ContactDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	return <ContactPage contactId={id} />;
}
