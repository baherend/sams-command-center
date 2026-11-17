# CRDC — Research & Development Center Platform

[English](README.md) | [العربية](README.ar.md)

## 1. Project Overview

The **CRDC Platform** is a proposed digital platform for the Consultancy, Research and Development Center (CRDC) at Sadat Academy.

The project aims to develop an integrated prototype demonstrating how the center's services, researcher requests, administrative operations, chatbot assistance, and performance analytics can be managed through one centralized platform.

The prototype will initially be developed independently from the current Sadat Academy website. Future integration with the existing Joomla/PHP website may be evaluated after the prototype is presented and the Academy approves the next phase.

> **Important:** This is a free training and demonstration initiative. The prototype is not an official Academy system and is not connected to the Academy's production systems.

## 2. Project Objectives

- Organize and digitize information about CRDC services.
- Provide researchers with a portal to explore services and submit demonstration requests.
- Allow researchers to track their application status and updates.
- Provide center staff with an administrative interface to manage requests.
- Develop a chatbot to answer questions about the center's services.
- Provide management with dashboards and Key Performance Indicators (KPIs).
- Demonstrate the feasibility of a future digital transformation solution for CRDC.

## 3. Project Scope

The prototype is planned as a full integrated platform consisting of the following modules.

### 3.1 Researcher Portal

- Researcher registration and login.
- Researcher profile management.
- Browse available CRDC services.
- View service descriptions and requirements.
- Submit demonstration service requests.
- Upload demonstration documents.
- Generate a unique Application ID.
- Track application status and updates.
- View additional document requests and notifications.

### 3.2 Admin Dashboard

- Staff/Admin authentication and authorization.
- View and manage researcher applications.
- Search and filter applications.
- Review submitted information and documents.
- Update application statuses.
- Request additional documents.
- Maintain application history.
- Manage service information.

### 3.3 Chatbot

- Build a Knowledge Base using available CRDC documentation.
- Answer questions about center services.
- Explain service requirements and procedures.
- Provide guidance based on available source documents.
- Integrate the chatbot into the main platform.

#### Proposed Chatbot Development Roadmap

The chatbot will be developed incrementally in four stages. Each stage should be implemented, tested, and evaluated before moving to the next one:

1. **Phase 1 – Basic RAG:** Build a basic Retrieval-Augmented Generation (RAG) system using the available CRDC documents as its knowledge source.
2. **Phase 2 – Retrieval Improvements:** Improve retrieval quality by introducing **Hybrid Search** and **Reranking**.
3. **Phase 3 – Conversation Context & Sources:** Add **Conversation Memory** to support follow-up questions and provide clear source references for answers.
4. **Phase 4 – Platform Integration:** Connect the chatbot to the platform **Backend** and **Researcher Portal**, subject to the platform APIs, authentication, and authorization design.

Progression between stages will be based on testing and evaluation of the current stage, including answer relevance, retrieval quality, and source-grounding. The implementation should remain compatible with the project's zero-budget policy and local-development approach.

### 3.4 Analytics & KPIs

- Total applications.
- Applications by service.
- Applications by status.
- Completed and pending applications.
- Average processing time.
- Service performance indicators.

### 3.5 Backend & Database

- Centralized data management.
- Authentication and role-based authorization.
- Application and service management.
- Document management.
- REST API development.
- Integration between platform modules.

## 4. Approved Project Decisions

The following decisions are approved for the current prototype:

| Item | Approved Decision |
|---|---|
| Architecture | Standalone Prototype |
| Scope | Full Integrated Platform |
| Development/Execution | Local Development |
| Budget | Zero Budget (0 EGP) |
| Data | Synthetic / Generated Data Only |
| Future Integration | Joomla/PHP website, subject to Academy approval |

### Important Notes

- The platform will initially operate independently.
- No changes will be made to the official Academy website during this project phase.
- No real researcher personal data will be used.
- Demonstration accounts, applications, and documents will use synthetic data.
- Future integration with Joomla will be evaluated after the prototype is presented and the Academy approves proceeding.

## 5. Proposed Technology Stack

The technologies below are initial proposals, not mandatory or final decisions.

| Component | Proposed Technology |
|---|---|
| Frontend | React |
| Backend | Laravel / PHP |
| Database | MySQL |
| Chatbot Service | Python / FastAPI |
| API Communication | REST APIs |
| Version Control | Git / GitHub |

### Technology Selection Policy

The final technology stack will be determined collaboratively after reviewing:

1. Team members' existing technical skills.
2. Available development environments and hardware.
3. Compatibility between selected technologies.
4. Integration requirements between modules.
5. Free and open-source availability.
6. Long-term maintainability and possible Joomla integration.

Team members are encouraged to suggest alternative technologies with clear technical reasons and an explanation of their impact on the rest of the system.

No proposed technology is mandatory until the team discusses and approves the final stack. The selected stack and this README may be updated as the project evolves.

## 6. Zero-Budget Policy

This is a free training initiative. All development and demonstration activities must follow a strict zero-budget policy.

- No paid hosting services.
- No paid APIs.
- No paid software licenses.
- No paid AI subscriptions.
- No paid domains.
- Prefer free and open-source technologies.
- Use free-tier services only when their limits are acceptable and no payment is required.

Any service that may introduce a cost must be discussed and approved before use. Local development is the current deployment decision; no cloud hosting is required for the current phase.

## 7. Development Roadmap

| Phase | Description | Main Deliverable |
|---|---|---|
| Phase 1 | Requirements & System Design | Requirements and Architecture |
| Phase 2 | Database & Backend | Database Schema and APIs |
| Phase 3 | Frontend Development | Researcher and Admin Interfaces |
| Phase 4 | Chatbot Development | Integrated CRDC Chatbot |
| Phase 5 | Analytics & KPIs | Management Dashboard |
| Phase 6 | Integration & Testing | Integrated Prototype |
| Phase 7 | Local Demo & Presentation | Demonstration-Ready Product |

Phase progress will be tracked using:

- Not Started
- In Progress
- Completed

## 8. Team Structure & Responsibilities

### Team Leader — Baher

- Overall project coordination.
- Requirements and scope supervision.
- Communication between development teams.
- Pull Request reviews and final merging.
- System integration and quality supervision.
- Project documentation.

### Chatbot Team

**Members:** Hager, Nada, Alaa

**Responsibilities:**
- Knowledge Base preparation.
- Chatbot development.
- CRDC service information integration.
- Answer accuracy testing.
- Chatbot integration with the main platform.

### Platform Development Team

**Members:** Salma, Samar, Omar

**Responsibilities:**
- Frontend development.
- Backend development.
- Database implementation.
- API development.
- Authentication and authorization.
- Researcher Portal and Admin Dashboard.
- Integration with other modules.

### Dashboard & KPIs

**Member:** Menna

**Responsibilities:**
- Dashboard interface.
- KPI definitions.
- Data visualization.
- Application statistics.
- Performance indicators.

This responsibility will be coordinated with the Platform Development Team so analytics uses the platform's shared data and APIs.

> Team responsibilities are the current proposed allocation and may be adjusted after discussing members' skills, availability, and preferences.

## 9. Proposed Repository Structure

```text
CRDC/
├── README.md
├── README.ar.md
├── docs/
│   ├── requirements/
│   ├── architecture/
│   ├── database/
│   ├── api/
│   └── user-guides/
├── frontend/
├── backend/
├── chatbot/
├── analytics/
├── database/
│   ├── schema/
│   ├── migrations/
│   └── seeders/
└── tests/
```

The repository structure may be adjusted according to the final technology stack and the team's workflow.

## 10. GitHub Collaboration Workflow

To maintain code quality and avoid conflicts:

1. The `main` branch is intended to contain the stable project version.
2. Direct pushes to `main` should be avoided.
3. Each contributor should work on a dedicated feature branch.
4. Changes should be submitted through Pull Requests.
5. Pull Requests should be reviewed before merging.
6. The Team Leader coordinates final integration.
7. Important technical decisions and changes should be documented.

### Suggested Branch Naming

- `feature/researcher-portal`
- `feature/admin-dashboard`
- `feature/backend-api`
- `feature/database`
- `feature/chatbot`
- `feature/kpis`
- `feature/documentation`
- `feature/testing`

## 11. Project Development Principles

- Modular and maintainable code.
- Clear separation of responsibilities.
- Consistent API communication.
- Secure authentication and authorization.
- Synthetic data only.
- Free and open-source tools whenever possible.
- Documentation for important changes.
- Collaborative technical decisions.

## 12. Future Integration with Sadat Academy Website

According to information provided by the Academy website manager, the current website uses Joomla and PHP.

After the prototype is completed and the Academy approves proceeding, the team may work with the Academy's technical representative to evaluate possible integration approaches, such as:

- Developing a custom Joomla component.
- Integrating the standalone platform through APIs.
- Deploying the application on an Academy-approved subdomain.
- Upgrading or adapting the existing hosting environment when necessary.

The final approach will depend on the existing Joomla and PHP versions, hosting capabilities, security requirements, and the Academy's approval.

No production integration or modification of the official website is included in the current prototype scope.

## 13. Project Status

**Current Status:** Planning & System Design

**Current Objective:** Establish requirements, architecture, team workflow, and the final technology stack before implementation.

**Project Budget:** 0 EGP

**Data Policy:** Synthetic Data Only

---

*This README is a living project document. It may be updated as the project evolves, technical decisions change, and the team agrees on new requirements or implementation approaches. The English and Arabic versions should be kept consistent.*
