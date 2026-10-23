import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@Real-Estate-CRM/ui/components/card";

/** Centered, phone-friendly card for sign-in and account pages. */
export function AuthCard({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex justify-center px-4 py-10">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>
						<h1>{title}</h1>
					</CardTitle>
					{description && <CardDescription>{description}</CardDescription>}
				</CardHeader>
				<CardContent>{children}</CardContent>
			</Card>
		</div>
	);
}
