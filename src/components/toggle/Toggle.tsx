import { useState, useEffect, useRef } from 'react';

import './Toggle.scss';

export function Toggle({
  defaultValue = false,
  values,
  labels,
  tips,
  onChange = () => {},
}: {
  defaultValue?: string | boolean;
  values?: string[];
  labels?: any[];
  tips?: string[]
  onChange?: (isEnabled: boolean, value: string) => void;
}) {
  if (typeof defaultValue === 'string') {
    defaultValue = !!Math.max(0, (values || []).indexOf(defaultValue));
  }

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState<boolean>(defaultValue);

  const toggleValue = () => {
    const v = !value;
    const index = +v;
    setValue(v);
    onChange(v, (values || [])[index]);
  };

  useEffect(() => {
    const leftEl = leftRef.current;
    const rightEl = rightRef.current;
    const bgEl = bgRef.current;
    if (leftEl && rightEl && bgEl) {
      if (value) {
        bgEl.style.left = rightEl.offsetLeft + 'px';
        bgEl.style.width = rightEl.offsetWidth + 'px';
      } else {
        bgEl.style.left = '';
        bgEl.style.width = leftEl.offsetWidth + 'px';
      }
    }
  }, [value]);

  return (
    <div
      data-component="Toggle"
      onClick={toggleValue}
      data-enabled={value.toString()}
    >
      {labels && (
        <div className="label left" ref={leftRef} title={tips && tips[0]}>
          {labels[0]}
        </div>
      )}
      {labels && (
        <div className="label right" ref={rightRef} title={tips && tips[1]}>
          {labels[1]}
        </div>
      )}
      <div className="toggle-background" ref={bgRef}></div>
    </div>
  );
}
