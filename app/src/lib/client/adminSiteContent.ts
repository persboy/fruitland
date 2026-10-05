import type {
  CreateFaqInput,
  CreateSlideInput,
  FaqDto,
  SiteContentPageDto,
  SlideDto,
  SocialLinksDto,
  UpdateFaqInput,
  UpdateSiteContentPageInput,
  UpdateSlideInput,
  UpdateSocialLinksInput,
} from "@fruitland/shared";
import { apiFetch } from "./apiClient";

export type { FaqDto, SiteContentPageDto, SlideDto, SocialLinksDto };

const enc = encodeURIComponent;

export const fetchSitePages = () => apiFetch<SiteContentPageDto[]>("/admin/site-content/pages");
export const updateSitePage = (slug: string, body: UpdateSiteContentPageInput) =>
  apiFetch<SiteContentPageDto>(`/admin/site-content/pages/${enc(slug)}`, { method: "PATCH", body });

export const fetchFaqs = () => apiFetch<FaqDto[]>("/admin/site-content/faqs");
export const createFaq = (body: CreateFaqInput) => apiFetch<FaqDto>("/admin/site-content/faqs", { method: "POST", body });
export const updateFaq = (id: string, body: UpdateFaqInput) => apiFetch<FaqDto>(`/admin/site-content/faqs/${enc(id)}`, { method: "PATCH", body });
export const setFaqActive = (id: string, isActive: boolean) =>
  apiFetch<FaqDto>(`/admin/site-content/faqs/${enc(id)}/status`, { method: "PATCH", body: { isActive } });

export const fetchSlides = () => apiFetch<SlideDto[]>("/admin/site-content/slides");
export const createSlide = (body: CreateSlideInput) => apiFetch<SlideDto>("/admin/site-content/slides", { method: "POST", body });
export const updateSlide = (id: string, body: UpdateSlideInput) =>
  apiFetch<SlideDto>(`/admin/site-content/slides/${enc(id)}`, { method: "PATCH", body });
export const setSlideActive = (id: string, isActive: boolean) =>
  apiFetch<SlideDto>(`/admin/site-content/slides/${enc(id)}/status`, { method: "PATCH", body: { isActive } });

export const fetchSocialLinks = () => apiFetch<SocialLinksDto>("/admin/site-content/social-links");
export const updateSocialLinks = (body: UpdateSocialLinksInput) =>
  apiFetch<SocialLinksDto>("/admin/site-content/social-links", { method: "PATCH", body });
