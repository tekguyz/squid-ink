import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev log prints every Server Function call with its arguments. The
  // sign-in action takes the password as an argument, so it landed in the log.
  logging: { serverFunctions: false },
};

export default nextConfig;
