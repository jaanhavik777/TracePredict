import SignupForm from "@/components/product/SignupForm";
import { productSignupEnabled } from "@/lib/product";

export const dynamic = "force-dynamic";
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  return <SignupForm invite={typeof invite === "string" ? invite : ""} registrationOpen={productSignupEnabled()} />;
}
