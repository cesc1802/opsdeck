import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

type JumpHandler = (index: number) => void;

interface MessageJump {
  /** Scroll the open session's message view to the given message index. */
  jumpTo: JumpHandler;
  /** Registered by the message view while a session is open. */
  setHandler: (handler: JumpHandler | null) => void;
}

const MessageJumpContext = createContext<MessageJump | null>(null);

export function MessageJumpProvider({ children }: { children: ReactNode }) {
  const handlerRef = useRef<JumpHandler | null>(null);
  const jumpTo = useCallback<JumpHandler>((index) => {
    handlerRef.current?.(index);
  }, []);
  const setHandler = useCallback((handler: JumpHandler | null) => {
    handlerRef.current = handler;
  }, []);
  const value = useMemo(() => ({ jumpTo, setHandler }), [jumpTo, setHandler]);
  return (
    <MessageJumpContext.Provider value={value}>
      {children}
    </MessageJumpContext.Provider>
  );
}

export function useMessageJump(): MessageJump {
  const context = useContext(MessageJumpContext);
  if (!context) {
    throw new Error("useMessageJump requires a MessageJumpProvider ancestor");
  }
  return context;
}
