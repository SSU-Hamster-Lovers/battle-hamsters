"use client";

import { useState, useEffect, useCallback } from "react";

const SERVER_API =
  process.env.NEXT_PUBLIC_SERVER_API_URL ?? "http://localhost:8081";
const GAME_URL =
  process.env.NEXT_PUBLIC_GAME_URL ?? "http://localhost:5173";

const NAME_KEY = "battle-hamsters-player-name";
const ID_KEY = "battle-hamsters-player-id";

function getOrCreateId(): string {
  if (typeof window === "undefined") return "";
  const existing = localStorage.getItem(ID_KEY);
  if (existing) return existing;
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(ID_KEY, id);
  return id;
}

function buildGameUrl(roomId: string, name: string, pid: string): string {
  const params = new URLSearchParams({ room: roomId, name, pid });
  if (typeof window !== "undefined") {
    const currentParams = new URLSearchParams(window.location.search);
    for (const key of ["ops", "debug"]) {
      const value = currentParams.get(key);
      if (value !== null) {
        params.set(key, value);
      }
    }
  }
  // Cloudflare Pages production project currently returns 404 for `/?query=...`.
  // Use hash handoff so the static host only receives `/`, while the game client
  // can still recover room/name/pid from `location.hash`.
  return `${GAME_URL}#${params.toString()}`;
}

export default function Home() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [createdRoomId, setCreatedRoomId] = useState<string | null>(null);
  const [loading, setLoading] = useState<"free" | "create" | "join" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) setName(saved);
  }, []);

  const saveName = (value: string) => {
    setName(value);
    localStorage.setItem(NAME_KEY, value);
  };

  const pid = useCallback(getOrCreateId, [])();

  const guardName = (): boolean => {
    if (!name.trim()) {
      setError("닉네임을 입력해주세요.");
      return false;
    }
    setError(null);
    return true;
  };

  const handleFreePlay = async () => {
    if (!guardName()) return;
    setLoading("free");
    try {
      const res = await fetch(`${SERVER_API}/rooms/free`);
      const data = await res.json();
      window.location.href = buildGameUrl(data.roomId, name.trim(), pid);
    } catch {
      setError("서버에 접속할 수 없습니다. 서버가 실행 중인지 확인해주세요.");
    } finally {
      setLoading(null);
    }
  };

  const handleCreateRoom = async () => {
    if (!guardName()) return;
    setLoading("create");
    try {
      const res = await fetch(`${SERVER_API}/rooms`, { method: "POST" });
      const data = await res.json();
      setCreatedCode(data.code);
      setCreatedRoomId(data.roomId);
    } catch {
      setError("방 생성에 실패했습니다.");
    } finally {
      setLoading(null);
    }
  };

  const handleEnterCreatedRoom = () => {
    if (!createdRoomId || !guardName()) return;
    window.location.href = buildGameUrl(createdRoomId, name.trim(), pid);
  };

  const handleJoinByCode = () => {
    if (!guardName()) return;
    const trimmed = code.trim();
    if (trimmed.length !== 4 || !/^\d{4}$/.test(trimmed)) {
      setError("4자리 숫자 코드를 입력해주세요.");
      return;
    }
    // 코드 → roomId 는 서버가 WS join_room 에서 처리하므로 클라이언트는 room 파라미터로 코드를 전달
    window.location.href = buildGameUrl(trimmed, name.trim(), pid);
  };

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* 헤더 */}
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">🐹 Battle Hamsters</h1>
          <p className="text-gray-400 text-sm">귀여운 햄스터들의 2D 아레나 PvP</p>
        </div>

        {/* 닉네임 */}
        <div className="space-y-1">
          <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">
            닉네임
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => saveName(e.target.value)}
            placeholder="hammy-1234"
            maxLength={20}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600"
          />
        </div>

        {/* 에러 */}
        {error && (
          <p className="text-red-400 text-sm text-center">{error}</p>
        )}

        {/* 자유맵 */}
        <div className="space-y-2">
          <button
            onClick={handleFreePlay}
            disabled={loading !== null}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg font-medium text-sm transition-colors"
          >
            {loading === "free" ? "접속 중..." : "🌐 자유맵 입장"}
          </button>
          <p className="text-center text-gray-500 text-xs">
            언제든 들어오고 나갈 수 있는 자유 플레이 맵
          </p>
        </div>

        <div className="border-t border-gray-800" />

        {/* 방 만들기 */}
        <div className="space-y-3">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">
            방 만들기
          </p>
          {createdCode ? (
            <div className="space-y-3">
              <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center space-y-1">
                <p className="text-xs text-gray-400">방 코드</p>
                <p className="text-4xl font-mono font-bold tracking-[0.3em] text-blue-400">
                  {createdCode}
                </p>
                <p className="text-xs text-gray-500">친구에게 이 코드를 공유하세요</p>
              </div>
              <button
                onClick={handleEnterCreatedRoom}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium text-sm transition-colors"
              >
                방 입장하기
              </button>
              <button
                onClick={() => {
                  setCreatedCode(null);
                  setCreatedRoomId(null);
                }}
                className="w-full py-1.5 text-gray-500 hover:text-gray-300 text-sm transition-colors"
              >
                취소
              </button>
            </div>
          ) : (
            <button
              onClick={handleCreateRoom}
              disabled={loading !== null}
              className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg font-medium text-sm transition-colors"
            >
              {loading === "create" ? "생성 중..." : "방 만들기"}
            </button>
          )}
        </div>

        {/* 코드로 입장 */}
        <div className="space-y-2">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">
            코드로 입장
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="0000"
              maxLength={4}
              className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm font-mono text-center tracking-widest focus:outline-none focus:border-blue-500 placeholder-gray-600"
            />
            <button
              onClick={handleJoinByCode}
              disabled={loading !== null || code.length !== 4}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg font-medium text-sm transition-colors"
            >
              입장
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
