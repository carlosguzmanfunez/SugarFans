import React, { useEffect, useRef, useState } from 'react';

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src: string };

// Keep the original URL and bytes. Off-screen photos do not get a source until
// they approach the viewport; native lazy loading alone can fetch much farther ahead.
const DeferredImage: React.FC<Props> = ({ src, alt = '', ...props }) => {
  const image = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = image.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <img {...props} ref={image} src={visible ? src : undefined} alt={alt} loading="lazy" decoding="async" />;
};

export default DeferredImage;
