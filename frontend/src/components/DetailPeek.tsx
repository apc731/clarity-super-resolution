import { useEffect, useRef, useState } from "react";

interface DetailPeekProps {
  beforeSrc: string;
  afterSrc: string;
  /** 取景中心（相对图片的百分比），默认画面中央偏上 */
  focus?: { x: number; y: number };
  label?: string;
}

/**
 * 1:1 像素对照：两块窗口显示同一块画面内容，各按自己的原分辨率摆放。
 *
 * 做法是让两张图都按"占自身宽度的同一比例"放大再裁剪，比例由右侧那张的
 * 实际像素宽度和窗口宽度算出来，所以右边每个屏幕像素正好等于 1 个输出像素，
 * 左边则是把 1 个源像素放大 4 倍摊开——这就是"糊"和"清楚"的原始差别。
 */
export default function DetailPeek({ beforeSrc, afterSrc, focus = { x: 50, y: 52 }, label }: DetailPeekProps) {
  const pairRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState({ before: 0, after: 0 });
  const [paneWidth, setPaneWidth] = useState(0);

  useEffect(() => {
    const before = new Image();
    const after = new Image();
    before.onload = () => setNatural((prev) => ({ ...prev, before: before.naturalWidth }));
    after.onload = () => setNatural((prev) => ({ ...prev, after: after.naturalWidth }));
    before.src = beforeSrc;
    after.src = afterSrc;
  }, [beforeSrc, afterSrc]);

  useEffect(() => {
    const element = pairRef.current;
    if (!element) return;
    const measure = () => {
      const first = element.firstElementChild as HTMLElement | null;
      if (first) setPaneWidth(first.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const reference = natural.after || natural.before;
  const size = reference && paneWidth ? `${(reference / paneWidth) * 100}% auto` : "cover";

  const paneStyle = (src: string): React.CSSProperties => ({
    backgroundImage: `url(${src})`,
    backgroundSize: size,
    backgroundPosition: `${focus.x}% ${focus.y}%`,
  });

  return (
    <figure className="peek">
      <div className="peek__pair" ref={pairRef}>
        <div className="peek__pane" style={paneStyle(beforeSrc)} role="img" aria-label="原图 1:1 细节">
          <span className="peek__tag">原图 · 1:1</span>
        </div>
        <div className="peek__pane" style={paneStyle(afterSrc)} role="img" aria-label="增强后 1:1 细节">
          <span className="peek__tag">增强后 · 1:1</span>
        </div>
      </div>
      <figcaption className="peek__caption">
        {label ?? "同一块画面，按原分辨率摆在一起：左边源图就这么点像素，右边是模型补出来的。"}
      </figcaption>
    </figure>
  );
}
