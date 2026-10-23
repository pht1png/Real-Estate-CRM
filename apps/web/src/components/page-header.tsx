export function PageHeader({
	title,
	description,
}: {
	title: string;
	description?: string;
}) {
	return (
		<div className="flex flex-col gap-1">
			<h1 className="text-2xl font-semibold">{title}</h1>
			{description && (
				<p className="text-muted-foreground max-w-prose">{description}</p>
			)}
		</div>
	);
}
