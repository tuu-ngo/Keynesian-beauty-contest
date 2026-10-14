import { NextResponse } from "next/server";

// POST /api/games: create a game. TODO: README section 4.3.
export async function POST() {
  return NextResponse.json(
    { error: { code: "not_implemented", message: "Game creation is not implemented yet." } },
    { status: 501 },
  );
}
