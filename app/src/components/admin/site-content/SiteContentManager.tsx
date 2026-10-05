"use client";

import { FaqSection } from "./FaqSection";
import { PagesSection } from "./PagesSection";
import { SlidesSection } from "./SlidesSection";
import { SocialLinksSection } from "./SocialLinksSection";

/** /admin/site-content — static pages, FAQ, homepage slides and social links. Each section loads and fails independently. */
export function SiteContentManager() {
  return (
    <div className="space-y-10">
      <PagesSection />
      <FaqSection />
      <SlidesSection />
      <SocialLinksSection />
    </div>
  );
}
