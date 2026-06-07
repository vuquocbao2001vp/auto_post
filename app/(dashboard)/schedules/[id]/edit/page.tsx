import { ScheduleForm } from "@/components/schedule-form";

type EditSchedulePageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditSchedulePage({ params }: EditSchedulePageProps) {
  const { id } = await params;
  return <ScheduleForm mode="edit" scheduleId={id} />;
}
