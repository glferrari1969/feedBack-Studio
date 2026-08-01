import { useEffect, useMemo, useRef, useState } from "react";

interface MusicXmlPreviewProps {
  xml: string;
  zoom: number;
  hideErrorMessage?: boolean;
  onRenderErrorChange?: (message: string | null) => void;
  onRenderedSvgPagesChange?: (pages: string[]) => void;
}

function applyStableSystemSpacing(osmd: any) {
  const rules = osmd?.EngravingRules;
  if (!rules) return;

  // Keep staff pair compact and system spacing predictable across pages.
  rules.BetweenStaffDistance = 2.5;
  rules.StaffDistance = 3.5;
  rules.MinSkyBottomDistBetweenSystems = 1;
  rules.MinimumDistanceBetweenSystems = 7;
  if (typeof rules.ChordSymbolYAlignment === "boolean") {
    rules.ChordSymbolYAlignment = true;
  }
  if (typeof rules.ChordSymbolYAlignmentScope === "string") {
    rules.ChordSymbolYAlignmentScope = "page";
  }
}

function sanitizeMusicXmlForOsmd(xml: string): string {
  const input = xml.trim();
  if (!input) return xml;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(input, "application/xml");
    if (doc.querySelector("parsererror")) {
      return xml;
    }

    doc.querySelectorAll("credit").forEach((node) => node.remove());
    doc.querySelectorAll("identification > creator").forEach((node) => node.remove());

    doc
      .querySelectorAll(
        "part-name, part-abbreviation, part-name-display, part-abbreviation-display, instrument-name, instrument-abbreviation",
      )
      .forEach((node) => {
        node.textContent = " ";
      });

    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}

function sanitizeMusicXmlForOsmdFallback(xml: string): string {
  const input = xml.trim();
  if (!input) return xml;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(input, "application/xml");
    if (doc.querySelector("parsererror")) {
      return xml;
    }

    doc
      .querySelectorAll(
        "tie, tied, slur, glissando, slide, hammer-on, pull-off, ornaments, technical, articulations, fermata, tuplet",
      )
      .forEach((node) => node.remove());

    doc.querySelectorAll("notations").forEach((node) => {
      if (!node.children.length) {
        node.remove();
      }
    });

    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}

export function MusicXmlPreview({
  xml,
  zoom,
  hideErrorMessage = false,
  onRenderErrorChange,
  onRenderedSvgPagesChange,
}: MusicXmlPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<any>(null);
  const zoomRef = useRef(zoom);
  const renderVersionRef = useRef(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const displayXml = useMemo(() => sanitizeMusicXmlForOsmd(xml), [xml]);
  const stableFallbackXml = useMemo(() => sanitizeMusicXmlForOsmdFallback(displayXml), [displayXml]);

  useEffect(() => {
    zoomRef.current = zoom;
    if (!displayXml.trim() || !osmdRef.current) return;

    try {
      applyStableSystemSpacing(osmdRef.current);
      osmdRef.current.Zoom = zoom;
      osmdRef.current.render();
      setRenderError(null);
      onRenderErrorChange?.(null);
      if (containerRef.current) {
        const serializer = new XMLSerializer();
        const pages = Array.from(containerRef.current.querySelectorAll("svg")).map((svg) =>
          serializer.serializeToString(svg),
        );
        onRenderedSvgPagesChange?.(pages);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fullMessage = `MusicXML render failed: ${message}`;
      setRenderError(fullMessage);
      onRenderErrorChange?.(fullMessage);
    }
  }, [displayXml, onRenderErrorChange, zoom]);

  useEffect(() => {
    let cancelled = false;
    const renderVersion = renderVersionRef.current + 1;
    renderVersionRef.current = renderVersion;

    const renderScore = async () => {
      if (!containerRef.current) return;
      if (!displayXml.trim()) {
        containerRef.current.innerHTML = "";
        setRenderError(null);
        onRenderErrorChange?.(null);
        onRenderedSvgPagesChange?.([]);
        return;
      }

      try {
        const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
        if (cancelled || !containerRef.current) return;

        if (!osmdRef.current) {
          osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, {
            autoResize: true,
            backend: "svg",
            pageFormat: "A4_P",
            drawingParameters: "default",
            drawTitle: false,
            renderSingleHorizontalStaffline: false,
            stretchLastSystemLine: false,
          });
        }

        await osmdRef.current.load(displayXml);
        if (cancelled || renderVersion !== renderVersionRef.current) return;
        applyStableSystemSpacing(osmdRef.current);
        osmdRef.current.Zoom = zoomRef.current;
        osmdRef.current.render();
        setRenderError(null);
        onRenderErrorChange?.(null);
        if (containerRef.current) {
          const serializer = new XMLSerializer();
          const pages = Array.from(containerRef.current.querySelectorAll("svg")).map((svg) =>
            serializer.serializeToString(svg),
          );
          onRenderedSvgPagesChange?.(pages);
        }
      } catch (error) {
        if (cancelled || renderVersion !== renderVersionRef.current) return;

        try {
          await osmdRef.current.load(stableFallbackXml);
          if (cancelled || renderVersion !== renderVersionRef.current) return;
          applyStableSystemSpacing(osmdRef.current);
          osmdRef.current.Zoom = zoomRef.current;
          osmdRef.current.render();
          setRenderError(null);
          onRenderErrorChange?.(null);
          if (containerRef.current) {
            const serializer = new XMLSerializer();
            const pages = Array.from(containerRef.current.querySelectorAll("svg")).map((svg) =>
              serializer.serializeToString(svg),
            );
            onRenderedSvgPagesChange?.(pages);
          }
        } catch (fallbackError) {
          if (cancelled || renderVersion !== renderVersionRef.current) return;
          const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          const fullMessage = `MusicXML render failed: ${message}`;
          setRenderError(fullMessage);
          onRenderErrorChange?.(fullMessage);
          onRenderedSvgPagesChange?.([]);
        }
      }
    };

    void renderScore();

    return () => {
      cancelled = true;
    };
  }, [displayXml, onRenderErrorChange, onRenderedSvgPagesChange, stableFallbackXml]);

  return (
    <div className="musicXmlPreviewPanel">
      {!hideErrorMessage && renderError ? <p className="hint slimHint">{renderError}</p> : null}
      <div className="musicXmlCanvas" ref={containerRef} aria-label="MusicXML preview" />
    </div>
  );
}
