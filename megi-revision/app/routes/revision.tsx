import { Outlet } from "react-router";

export function meta() {
  return [{ title: "MEGI Revisión" }];
}

export default function RevisionLayout() {
  return <Outlet />;
}
