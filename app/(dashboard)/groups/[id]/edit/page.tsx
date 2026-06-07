import { GroupForm } from "@/components/group-form";

type EditGroupPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditGroupPage({ params }: EditGroupPageProps) {
  const { id } = await params;
  return <GroupForm groupId={id} />;
}
