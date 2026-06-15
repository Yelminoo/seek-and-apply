"""Pydantic models for ApplyPilot Server."""

from typing import Any, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    username: str
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    username: str
    user_id: str

class UserOut(BaseModel):
    username: str
    user_id: str


# ---------------------------------------------------------------------------
# Setup / Profile
# ---------------------------------------------------------------------------

class PersonalInfo(BaseModel):
    full_name: str = ""
    preferred_name: str = ""
    email: str = ""
    password: str = ""
    phone: str = ""
    address: str = ""
    city: str = ""
    province_state: str = ""
    country: str = ""
    postal_code: str = ""
    linkedin_url: str = ""
    github_url: str = ""
    portfolio_url: str = ""
    website_url: str = ""

class WorkAuthorization(BaseModel):
    legally_authorized_to_work: str = "Yes"
    require_sponsorship: str = "No"
    work_permit_type: str = ""

class Availability(BaseModel):
    earliest_start_date: str = "Immediately"
    available_for_full_time: str = "Yes"
    available_for_contract: str = "No"

class Compensation(BaseModel):
    salary_expectation: str = "85000"
    salary_currency: str = "USD"
    salary_range_min: str = "80000"
    salary_range_max: str = "100000"
    currency_conversion_note: str = ""

class Experience(BaseModel):
    years_of_experience_total: str = "3"
    education_level: str = "Bachelor's Degree"
    current_job_title: str = ""
    current_company: str = ""
    target_role: str = "software engineer"

class SkillsBoundary(BaseModel):
    languages: list[str] = []
    frameworks: list[str] = []
    devops: list[str] = []
    databases: list[str] = []
    tools: list[str] = []

class ResumeFacts(BaseModel):
    preserved_companies: list[str] = []
    preserved_projects: list[str] = []
    preserved_school: str = ""
    real_metrics: list[str] = []

class EEOVoluntary(BaseModel):
    gender: str = "Decline to self-identify"
    race_ethnicity: str = "Decline to self-identify"
    veteran_status: str = "I am not a protected veteran"
    disability_status: str = "I do not wish to answer"

class ProfileIn(BaseModel):
    personal: PersonalInfo = Field(default_factory=PersonalInfo)
    work_authorization: WorkAuthorization = Field(default_factory=WorkAuthorization)
    availability: Availability = Field(default_factory=Availability)
    compensation: Compensation = Field(default_factory=Compensation)
    experience: Experience = Field(default_factory=Experience)
    skills_boundary: SkillsBoundary = Field(default_factory=SkillsBoundary)
    resume_facts: ResumeFacts = Field(default_factory=ResumeFacts)
    eeo_voluntary: EEOVoluntary = Field(default_factory=EEOVoluntary)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

class PipelineRunRequest(BaseModel):
    stages: list[str] = ["all"]
    min_score: int = 7
    workers: int = 1
    validation: str = "normal"
    url_filter: list[str] = []
    results_per_site: int = 0  # 0 = use whatever is in searches.yaml

class ApplyRunRequest(BaseModel):
    limit: int = 5
    min_score: int = 7
    workers: int = 1
    model: str = "sonnet"
    dry_run: bool = False
    headless: bool = True
    url_filter: list[str] = []   # if set, only apply to these specific URLs
    url_filter: list[str] = []


# ---------------------------------------------------------------------------
# Jobs / Stats
# ---------------------------------------------------------------------------

class JobRow(BaseModel):
    url: str
    title: Optional[str] = None
    location: Optional[str] = None
    site: Optional[str] = None
    salary: Optional[str] = None
    fit_score: Optional[int] = None
    apply_status: Optional[str] = None
    applied_at: Optional[str] = None
    apply_attempts: Optional[int] = 0
    tailored_resume_path: Optional[str] = None
    cover_letter_path: Optional[str] = None
    discovered_at: Optional[str] = None
    has_description: Optional[bool] = False
    has_apply_url: Optional[bool] = False

    model_config = {"from_attributes": True}


class StageStats(BaseModel):
    total: int = 0
    with_description: int = 0
    scored: int = 0
    tailored: int = 0
    with_cover_letter: int = 0
    applied: int = 0
    ready_to_apply: int = 0
    score_distribution: list[tuple[int, int]] = []
    by_site: list[tuple[str, int]] = []

class StatusResponse(BaseModel):
    stats: StageStats = Field(default_factory=StageStats)
    setup_complete: bool = False
