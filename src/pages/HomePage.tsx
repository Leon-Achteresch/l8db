import { useState } from "react";
import reactLogo from "../assets/react.svg";
import { invoke } from "@tauri-apps/api/core";

export function HomePage() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="mx-auto flex flex-1 flex-col justify-center text-center">
      <h1 className="text-center text-3xl font-semibold">
        Welcome to Tauri + React
      </h1>

      <div className="mt-8 flex justify-center">
        <a href="https://vite.dev" target="_blank" rel="noreferrer">
          <img
            src="/vite.svg"
            className="h-24 p-6 transition will-change-[filter] hover:drop-shadow-[0_0_2em_#747bff]"
            alt="Vite logo"
          />
        </a>
        <a href="https://tauri.app" target="_blank" rel="noreferrer">
          <img
            src="/tauri.svg"
            className="h-24 p-6 transition will-change-[filter] hover:drop-shadow-[0_0_2em_#24c8db]"
            alt="Tauri logo"
          />
        </a>
        <a href="https://react.dev" target="_blank" rel="noreferrer">
          <img
            src={reactLogo}
            className="h-24 p-6 transition will-change-[filter] hover:drop-shadow-[0_0_2em_#61dafb]"
            alt="React logo"
          />
        </a>
      </div>
      <p className="mt-4">
        Click on the Tauri, Vite, and React logos to learn more.
      </p>

      <form
        className="mt-6 flex justify-center"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          className="mr-1.5 rounded-lg border border-transparent bg-white px-5 py-2.5 text-base font-medium text-neutral-900 shadow-sm transition-colors outline-none hover:border-blue-600 focus:border-blue-600 dark:bg-neutral-950/60 dark:text-white dark:hover:border-blue-600"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <button
          type="submit"
          className="cursor-pointer rounded-lg border border-transparent bg-white px-5 py-2.5 text-base font-medium text-neutral-900 shadow-sm transition-colors outline-none hover:border-blue-600 active:border-blue-600 active:bg-neutral-200 dark:bg-neutral-950/60 dark:text-white dark:active:bg-neutral-950/40"
        >
          Greet
        </button>
      </form>
      <p className="mt-4">{greetMsg}</p>
    </main>
  );
}
