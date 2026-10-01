import type { SVGProps } from 'react';

const paths = {
  selected: <><path d="M5 3h14v18l-7-4-7 4V3Z" /><path d="m9 9 2 2 4-4" /></>,
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></>,
  unread: <><path d="m4 4-2 10v5a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-5L20 4H4Z" /><path d="M2 14h6l2 3h4l2-3h6" /></>,
  starred: <path d="M11.6 3.8Q12 3 12.4 3.8L14.6 8.3Q14.8 8.7 15.2 8.8L20.1 9.5Q21 9.6 20.4 10.2L16.8 13.7Q16.5 14 16.6 14.4L17.4 19.3Q17.6 20.2 16.8 19.8L12.4 17.5Q12 17.3 11.6 17.5L7.2 19.8Q6.4 20.2 6.6 19.3L7.4 14.4Q7.5 14 7.2 13.7L3.6 10.2Q3 9.6 3.9 9.5L8.8 8.8Q9.2 8.7 9.4 8.3Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  appearance: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" /></>,
  moon: <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  download: <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  summary: <><path d="M13 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8M8 11h5M8 15h8M8 18h5" /><path d="m19 2 1.2 3.8L24 7l-3.8 1.2L19 12l-1.2-3.8L14 7l3.8-1.2Z" /></>,
  translate: <><path d="M3 5h11M8.5 3v2M5 5c.8 5 3.3 8 8 10M12 5c-.7 5-3.5 8.2-9 11M13 21l4.5-11L22 21M15 17h5" /></>,
  refresh: <>
    <path d="M4 10A8 8 0 0 1 17.7 6.3L20 8.5M20 4.5v4h-4" />
    <path d="M20 14a8 8 0 0 1-13.7 3.7L4 15.5M4 19.5v-4h4" />
  </>,
  history: <>
    <path d="M3.5 9a8.5 8.5 0 1 1 1.1 8M3.5 4.5V9H8" />
    <path d="M12 7.5V12l3 1.8" />
  </>,
  external: <>
    <path d="M10 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    <path d="M14 4h6v6m0-6-9 9" />
  </>,
  chevron: <path d="m9 5 7 7-7 7" />,
  edit: <><path d="m14 5 5 5M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  book: <><path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
  sources: <><rect x="3" y="3" width="6" height="18" rx="1" /><path d="M13 5h8M13 12h8M13 19h8" /></>,
};

export function ReaderIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}
