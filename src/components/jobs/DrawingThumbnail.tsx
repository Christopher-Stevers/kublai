"use client";
import { useEffect, useState } from "react";
import { useDrawingAccount } from "./DrawingAccountProvider";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { drawingThumbnailUrl } from "./drawing-scroll-pages";


export function DrawingThumbnail(
  props: React.ImgHTMLAttributes<HTMLImageElement> & { src: string },
) {
  const account = useDrawingAccount();
  const online = useOnlineStatus();
  // Full pages are ~2200px; decoding dozens of them while scrolling a folder
  // stutters, so cards use the small copy whenever the server can be reached.
  const [thumbnailFailed, setThumbnailFailed] = useState<string | null>(null);
  const thumbnail =
    online && thumbnailFailed !== props.src ? drawingThumbnailUrl(props.src) : null;
  const [resolved, setResolved] = useState<{
    src: string;
    url: string;
    account: string;
  } | null>(null);
  useEffect(() => {
    let stopped = false;
    if (account?.store && !thumbnail)
      void account.store
        .resolveAssetUrl(props.src)
        .then((url) => {
          if (!stopped)
            setResolved({ src: props.src, url, account: account.accountKey });
        })
        .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [account, props.src, thumbnail]);
  const src =
    thumbnail ??
    (resolved?.src === props.src && resolved.account === account?.accountKey
      ? resolved.url
      : props.src);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      src={src}
      alt={props.alt ?? ""}
      decoding="async"
      onError={(event) => {
        if (thumbnail) setThumbnailFailed(props.src);
        props.onError?.(event);
      }}
    />
  );
}
