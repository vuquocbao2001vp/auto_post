import { TemplateForm } from "@/components/template-form";

type EditTemplatePageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditTemplatePage({ params }: EditTemplatePageProps) {
  const { id } = await params;
  return <TemplateForm mode="edit" templateId={id} />;
}
