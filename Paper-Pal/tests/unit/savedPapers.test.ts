/**
 * Saved Papers Functionality Tests
 * 
 * Tests the complete saved papers management system
 */

import { describe, it, expect } from 'vitest';
import type { SavedPaper, SavedPapersListResponse, SavePaperRequest } from '@/api/types';

describe('Saved Papers Types and Structure', () => {
  describe('SavedPaper Type', () => {
    it('should have correct SavedPaper type structure', () => {
      const savedPaper: SavedPaper = {
        paper_id: 'test-id',
        saved_at: '2024-01-01T00:00:00Z',
        paper: {
          id: 'test-id',
          title: 'Test Title',
          abstract: 'Test Abstract',
          authors: ['Author 1'],
          categories: ['cs.AI'],
          published: '2024-01-01T00:00:00Z',
          source: 'arxiv',
          url: 'https://test.url',
        },
      };

      expect(savedPaper.paper_id).toBe('test-id');
      expect(savedPaper.paper?.title).toBe('Test Title');
      expect(savedPaper.paper?.source).toBe('arxiv');
    });

    it('should handle SavedPaper without paper data', () => {
      const savedPaper: SavedPaper = {
        paper_id: 'test-id',
        saved_at: '2024-01-01T00:00:00Z',
        paper: undefined,
      };

      expect(savedPaper.paper_id).toBe('test-id');
      expect(savedPaper.paper).toBeUndefined();
    });

    it('should handle SavedPaper with complete paper data', () => {
      const savedPaper: SavedPaper = {
        paper_id: 'arxiv-123',
        saved_at: '2024-12-26T15:30:00Z',
        paper: {
          id: 'arxiv-123',
          title: 'Advanced AI Research Paper',
          abstract: 'This paper presents novel approaches to AI.',
          authors: ['Dr. Smith', 'Prof. Johnson'],
          categories: ['cs.AI', 'cs.LG'],
          published: '2024-12-25T00:00:00Z',
          source: 'arxiv',
          url: 'https://arxiv.org/abs/arxiv-123',
          total_score: 9.2,
          one_liner: 'Groundbreaking AI research with practical applications.',
          pros: ['Novel approach', 'Strong experimental results'],
          cons: ['Limited dataset', 'Computational complexity'],
        },
      };

      expect(savedPaper.paper?.total_score).toBe(9.2);
      expect(savedPaper.paper?.pros).toHaveLength(2);
      expect(savedPaper.paper?.cons).toHaveLength(2);
    });
  });

  describe('SavedPapersListResponse Type', () => {
    it('should have correct response structure', () => {
      const response: SavedPapersListResponse = {
        saved_papers: [
          {
            paper_id: 'paper-1',
            saved_at: '2024-01-01T00:00:00Z',
            paper: undefined,
          },
          {
            paper_id: 'paper-2',
            saved_at: '2024-01-02T00:00:00Z',
            paper: {
              id: 'paper-2',
              title: 'Test Paper 2',
              abstract: 'Abstract 2',
              authors: ['Author 2'],
              categories: ['cs.CV'],
              published: '2024-01-02T00:00:00Z',
              source: 'huggingface',
              url: 'https://huggingface.co/papers/paper-2',
            },
          },
        ],
        total: 2,
      };

      expect(response.saved_papers).toHaveLength(2);
      expect(response.total).toBe(2);
      expect(response.saved_papers[0].paper).toBeUndefined();
      expect(response.saved_papers[1].paper?.source).toBe('huggingface');
    });

    it('should handle empty saved papers list', () => {
      const response: SavedPapersListResponse = {
        saved_papers: [],
        total: 0,
      };

      expect(response.saved_papers).toHaveLength(0);
      expect(response.total).toBe(0);
    });
  });

  describe('SavePaperRequest Type', () => {
    it('should have correct request structure', () => {
      const request: SavePaperRequest = {
        paper_id: 'test-paper-id',
        user_id: 'test-user',
      };

      expect(request.paper_id).toBe('test-paper-id');
      expect(request.user_id).toBe('test-user');
    });

    it('should handle optional user_id', () => {
      const request: SavePaperRequest = {
        paper_id: 'test-paper-id',
      };

      expect(request.paper_id).toBe('test-paper-id');
      expect(request.user_id).toBeUndefined();
    });
  });

  describe('Data Transformation', () => {
    it('should convert SavedPaper to PaperCard format', () => {
      const savedPaper: SavedPaper = {
        paper_id: 'test-id',
        saved_at: '2024-01-01T00:00:00Z',
        paper: {
          id: 'test-id',
          title: 'Test Paper',
          abstract: 'Test abstract',
          authors: ['Test Author'],
          categories: ['cs.AI', 'cs.LG'],
          published: '2024-01-01T00:00:00Z',
          source: 'arxiv',
          url: 'https://arxiv.org/abs/test-id',
          total_score: 8.5,
          one_liner: 'Great paper about AI',
          pros: ['Innovative approach'],
          cons: ['Limited scope'],
        },
      };

      // Simulate the conversion logic from SavedPapersPanel
      const paperCard = savedPaper.paper ? {
        id: savedPaper.paper.id,
        title: savedPaper.paper.title,
        score: savedPaper.paper.total_score || 0,
        tags: savedPaper.paper.categories || [],
        oneLiner: savedPaper.paper.one_liner || '',
        pros: savedPaper.paper.pros || [],
        cons: savedPaper.paper.cons || [],
        url: savedPaper.paper.url,
      } : null;

      expect(paperCard).not.toBeNull();
      expect(paperCard?.id).toBe('test-id');
      expect(paperCard?.title).toBe('Test Paper');
      expect(paperCard?.score).toBe(8.5);
      expect(paperCard?.tags).toEqual(['cs.AI', 'cs.LG']);
      expect(paperCard?.oneLiner).toBe('Great paper about AI');
      expect(paperCard?.pros).toEqual(['Innovative approach']);
      expect(paperCard?.cons).toEqual(['Limited scope']);
      expect(paperCard?.url).toBe('https://arxiv.org/abs/test-id');
    });

    it('should handle SavedPaper without paper data in conversion', () => {
      const savedPaper: SavedPaper = {
        paper_id: 'test-id',
        saved_at: '2024-01-01T00:00:00Z',
        paper: undefined,
      };

      // Simulate the filtering logic from SavedPapersPanel
      const shouldInclude = savedPaper.paper !== undefined;

      expect(shouldInclude).toBe(false);
    });
  });
});