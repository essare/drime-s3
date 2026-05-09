type Props = { visible: boolean };

export function DropOverlay({ visible }: Props) {
  if (!visible) return null;
  return (
    <div
      role="presentation"
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
    >
      <div className="rounded-xl border-2 border-dashed border-primary px-12 py-8 text-center">
        <div className="font-semibold text-2xl">Drop to upload</div>
        <p className="mt-1 text-muted-foreground text-sm">
          Files will be uploaded to the current folder
        </p>
      </div>
    </div>
  );
}
